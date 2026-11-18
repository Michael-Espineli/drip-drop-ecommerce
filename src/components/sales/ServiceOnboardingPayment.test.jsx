import React from 'react';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {httpsCallable} from 'firebase/functions';
import {Context} from '../../context/AuthContext';
import ServiceOnboardingPayment from './ServiceOnboardingPayment';
jest.mock('../../context/AuthContext', () => ({Context: require('react').createContext({})}));
jest.mock('../../utils/config', () => ({functions: {}}));
jest.mock('../../utils/callableAuth', () => ({getCallableAuthPayload: async () => ({idToken: 'user-token'})}));
jest.mock('firebase/functions', () => ({httpsCallable: jest.fn()}));
const agreement = {id: 'agreement', companyId: 'company', email: 'home@example.test'};
let commands;
beforeEach(() => {
  commands = {manageServiceOnboarding: jest.fn(async () => ({data: {billingReady: false, config: {}}})), createServiceOnboardingCheckout: jest.fn(async () => ({data: {}}))};
  httpsCallable.mockImplementation((_, name) => commands[name]);
});
const mount = () => render(<Context.Provider value={{user: null}}><ServiceOnboardingPayment agreement={agreement} email={agreement.email} accessToken="private-token" /></Context.Provider>);
test('a signed email recipient can authorize secure setup without creating an account', async () => {
  mount(); const button = await screen.findByRole('button', {name: 'Continue to Secure Payment Setup'});
  expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(button);
  await waitFor(() => expect(commands.createServiceOnboardingCheckout).toHaveBeenCalledWith(expect.objectContaining({companyId: 'company', agreementId: 'agreement',
    accessToken: 'private-token', email: 'home@example.test', paymentMethodType: 'card', requestId: expect.any(String)})));
  expect(commands.createServiceOnboardingCheckout.mock.calls[0][0]).not.toHaveProperty('idToken');
});
test('invoice customers see their approved day and terms instead of an enabled payment setup', async () => {
  commands.manageServiceOnboarding.mockResolvedValue({data: {billingReady: true, config: {collectionMethod: 'invoice', invoiceSendDay: 31, paymentTerms: 'net15'}}});
  mount(); expect(await screen.findByText(/invoice sends on day 31/)).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Continue to Secure Payment Setup'})).not.toBeInTheDocument();
});
test('pending bank authorization exposes verification and does not claim billing is complete', async () => {
  commands.manageServiceOnboarding.mockResolvedValue({data: {billingReady: false, config: {}, verificationUrl: 'https://verify.stripe.com/test'}});
  mount(); expect(await screen.findByRole('link', {name: 'Complete Bank Verification'})).toHaveAttribute('href', 'https://verify.stripe.com/test');
  expect(screen.queryByText('Billing information and payment authorization are complete.')).not.toBeInTheDocument();
});
