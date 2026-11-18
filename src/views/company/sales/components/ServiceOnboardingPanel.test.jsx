import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {httpsCallable} from 'firebase/functions';
import ServiceOnboardingPanel from './ServiceOnboardingPanel';
jest.mock('../../../../utils/config', () => ({db: {}, functions: {}}));
jest.mock('../../../../utils/callableAuth', () => ({getCallableAuthPayload: async () => ({idToken: 'staff-token'})}));
jest.mock('firebase/firestore', () => ({doc: (_, ...parts) => parts.join('/'), getDoc: async () => ({exists: () => true, data: () => ({billingAddress: {streetAddress: '123 Test Street', city: 'Test City', state: 'CA', zip: '90000'}})})}));
jest.mock('firebase/functions', () => ({httpsCallable: jest.fn()}));
const agreement = {id: 'agreement', companyId: 'company', customerId: 'customer', customerName: 'Pool Owner', email: 'home@example.test', status: 'accepted',
  onboardingWorkflowVersion: 1, totalAmountCents: 10000, lineItems: [{id: 'service', name: 'Service', quantity: 1, unitAmountCents: 10000, totalAmountCents: 10000}]};
let command, state;
beforeEach(() => {
  state = {ready: false, released: false, checks: [{id: 'billing', complete: false, label: 'Billing ready'}], preview: {timeZone: 'America/Los_Angeles'}};
  command = jest.fn(async payload => ({data: payload.action === 'status' ? state : {released: true}}));
  httpsCallable.mockReturnValue(command);
});
const mount = (canManage = true) => render(<MemoryRouter><ServiceOnboardingPanel agreement={agreement} canManage={canManage} /></MemoryRouter>);
test('monthly signup starts at the full amount, with proration available only after choosing a company override', async () => {
  mount(); await screen.findByText(/Billing ready/);
  expect(screen.getByLabelText('Onboarding billing schedule')).toHaveValue('signup');
  expect(screen.queryByLabelText(/Prorate the first/)).not.toBeInTheDocument();
  expect(screen.getByText('$100.00')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Onboarding billing schedule'), {target: {value: 'companyOverride'}});
  expect(screen.getByLabelText(/Prorate the first/)).not.toBeChecked();
  fireEvent.click(screen.getByLabelText(/Prorate the first/));
  expect(screen.getByRole('button', {name: 'Save Billing Arrangement'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText('I reviewed the initial prorated amount and service dates.'));
  expect(screen.getByRole('button', {name: 'Save Billing Arrangement'})).toBeEnabled();
});
test('office invoice setup supports every send day and submits its reason, contact and due terms to the server', async () => {
  mount(); await screen.findByText(/Billing ready/);
  await waitFor(() => expect(screen.getByLabelText('Billing street address')).toHaveValue('123 Test Street'));
  fireEvent.change(screen.getByLabelText('Onboarding collection method'), {target: {value: 'invoice'}});
  expect(screen.getByLabelText('Invoice-send day').options).toHaveLength(31);
  fireEvent.change(screen.getByLabelText('Invoice-send day'), {target: {value: '31'}});
  fireEvent.change(screen.getByLabelText('Onboarding payment terms'), {target: {value: 'net15'}});
  fireEvent.change(screen.getByLabelText('Billing override reason'), {target: {value: 'Office approved invoice customer'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save Billing Arrangement'}));
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({action: 'configure', agreementId: 'agreement', idToken: 'staff-token',
    config: expect.objectContaining({collectionMethod: 'invoice', invoiceSendDay: 31, paymentTerms: 'net15', prorationEnabled: false, reason: 'Office approved invoice customer'})})));
});
test('release is disabled until server readiness passes and financial readers cannot approve overrides', async () => {
  const view = mount(false); await screen.findByText(/Billing ready/);
  expect(screen.queryByRole('button', {name: 'Release First Service'})).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Save Billing Arrangement'})).toBeDisabled();
  view.unmount(); mount(); await screen.findByText(/Billing ready/);
  expect(screen.getByRole('button', {name: 'Release First Service'})).toBeDisabled();
  state = {...state, ready: true}; fireEvent.click(screen.getByRole('button', {name: 'Refresh readiness'}));
  await waitFor(() => expect(screen.getByRole('button', {name: 'Release First Service'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button', {name: 'Release First Service'}));
  await waitFor(() => expect(command).toHaveBeenCalledWith(expect.objectContaining({action: 'release', agreementId: 'agreement'})));
});
