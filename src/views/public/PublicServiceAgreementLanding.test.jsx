import React, { act, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { onSnapshot } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { Context } from '../../context/AuthContext';
import PublicServiceAgreementLanding from './PublicServiceAgreementLanding';
import ServiceAgreementDetail from '../client/serviceAgreements/ServiceAgreementDetail';
import HomeOwnerSignIn from '../auth/HomeOwnerSignIn';
import ClientEmailVerification from '../auth/ClientEmailVerification';

jest.mock('../../context/AuthContext', () => ({ Context: require('react').createContext({}) }));
jest.mock('../../utils/config', () => ({ db: {}, functions: {} }));
jest.mock('../../utils/callableAuth', () => ({ getCallableAuthPayload: async () => ({ idToken: 'signed-in-token' }) }));
jest.mock('../../utils/accountEmails', () => ({ sendClientEmailVerification: jest.fn() }));
jest.mock('../../utils/passwordReset', () => ({ sendAccountPasswordResetEmail: jest.fn(), PASSWORD_RESET_RECENTLY_SENT_CODE: 'recently-sent' }));
jest.mock('../../components/sales/PaymentMethodSelector', () => () => null);
jest.mock('firebase/auth', () => ({ getAuth: jest.fn(), signInWithEmailAndPassword: jest.fn(), signOut: jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('firebase/firestore', () => ({ doc: (_, ...parts) => parts.join('/'), onSnapshot: jest.fn() }));

const homeowner = { uid: 'homeowner', email: 'homeowner@example.test', emailVerified: true };
const agreement = { id: 'agreement', companyId: 'company', companyName: 'Sample Pool Company', customerName: 'Home Owner', customerUserId: homeowner.uid, email: homeowner.email, title: 'Weekly Pool Service', status: 'sent', terms: 'Weekly service terms', rateType: 'perMonth', totalAmountCents: 17500 };
const privatePath = '/customer/service-agreements/agreement?email=homeowner%40example.test&accessToken=private-token';
const profilePath = '/client/service-agreements/agreement';
let setSession, commands;
const Reporter = () => <output data-testid="destination">{useLocation().pathname}{useLocation().search}</output>;
const mount = (path = privatePath, initialUser = null, accountType = initialUser ? 'Client' : null) => {
  function Session() {
    const [session, update] = useState({ user: initialUser, accountType });
    setSession = update;
    return <Context.Provider value={{ ...session, refreshAccount: async () => false, featureFlagsLoaded: true, isFeatureEnabled: () => false }}>
      <Routes>
        <Route path="/customer/service-agreements/:agreementId" element={<PublicServiceAgreementLanding />} />
        <Route path="/client/service-agreements/:agreementId" element={<ServiceAgreementDetail />} />
        <Route path="/homeownerSignIn" element={<HomeOwnerSignIn />} />
        <Route path="/client/verify-email" element={<ClientEmailVerification />} />
        <Route path="/company/dashboard" element={<p>Company dashboard</p>} />
      </Routes>
      <Reporter />
    </Context.Provider>;
  }
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Session /></MemoryRouter>);
};
beforeEach(() => {
  jest.clearAllMocks();
  commands = Object.fromEntries(['getPublicServiceAgreement', 'acceptPublicSalesServiceAgreement', 'acceptSalesServiceAgreement', 'rejectPublicSalesServiceAgreement', 'rejectSalesServiceAgreement'].map(name => [name, jest.fn().mockResolvedValue({ data: name === 'getPublicServiceAgreement' ? { agreement } : { status: 'success' } })]));
  httpsCallable.mockImplementation((_, name) => commands[name]);
  getAuth.mockReturnValue({ currentUser: null });
  signInWithEmailAndPassword.mockImplementation(async () => {
    setSession({ user: homeowner, accountType: 'Client' });
    return { user: homeowner };
  });
  onSnapshot.mockImplementation((ref, next) => {
    queueMicrotask(() => next({ exists: () => true, id: 'agreement', data: () => agreement }));
    return () => {};
  });
});

test('a guest keeps the private review and receives sign-in and signup links to the exact profile agreement', async () => {
  mount();
  await screen.findByRole('heading', { name: 'Acceptance' });
  expect(screen.getByTestId('destination')).toHaveTextContent(privatePath);
  expect(commands.getPublicServiceAgreement).toHaveBeenCalledWith({ agreementId: 'agreement', email: homeowner.email, accessToken: 'private-token' });
  for (const name of ['Sign In', 'Create Account']) {
    const target = new URL(screen.getByRole('link', { name, exact: true }).getAttribute('href'), 'https://example.test');
    expect(target.searchParams.get('redirect')).toBe(profilePath);
    expect(target.href).not.toContain('private-token');
  }
});
test('an already signed-in homeowner lands directly on the profile agreement without fetching the private token', async () => {
  mount(privatePath, homeowner);
  await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent(profilePath));
  expect((await screen.findAllByText('Weekly Pool Service')).length).toBeGreaterThan(0);
  expect(commands.getPublicServiceAgreement).not.toHaveBeenCalled();
  expect(screen.getByTestId('destination')).not.toHaveTextContent('private-token');
  expect(onSnapshot).toHaveBeenCalledWith('salesAgreements/agreement', expect.any(Function), expect.any(Function));
});
test('following the private-page sign-in prompt opens the same agreement in the homeowner profile', async () => {
  mount();
  const signIn = await screen.findByRole('link', { name: 'Sign In', exact: true });
  fireEvent.click(signIn);
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: homeowner.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In', exact: true }));
  await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent(profilePath));
  await screen.findByRole('heading', { name: 'Acceptance' });
  expect(commands.getPublicServiceAgreement).toHaveBeenCalledTimes(1);
});
test('an older sign-in URL that returns to the private link also resolves to the profile agreement', async () => {
  mount(`/homeownerSignIn?redirect=${encodeURIComponent(privatePath)}`);
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: homeowner.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'example-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In', exact: true }));
  await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent(profilePath));
  expect(screen.getByTestId('destination')).not.toHaveTextContent('private-token');
});
test('email verification preserves the agreement destination after signup', async () => {
  const destination = `/client/verify-email?redirect=${encodeURIComponent(profilePath)}`;
  mount(destination, { ...homeowner, emailVerified: false });
  expect(screen.getByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
  await act(async () => setSession({ user: homeowner, accountType: 'Client' }));
  await waitFor(() => expect(screen.getByTestId('destination')).toHaveTextContent(profilePath));
  await screen.findByRole('heading', { name: 'Acceptance' });
});
test('a different signed-in homeowner cannot use the email token to view the agreement in their profile', async () => {
  mount(privatePath, { ...homeowner, uid: 'different-homeowner' });
  expect(await screen.findByText('This service agreement does not belong to your account.')).toBeInTheDocument();
  expect(screen.queryByText('Weekly Pool Service')).not.toBeInTheDocument();
  expect(commands.getPublicServiceAgreement).not.toHaveBeenCalled();
});
test('company sign-ins keep the valid private review instead of being sent to a homeowner route', async () => {
  mount(privatePath, { uid: 'company-user' }, 'Company');
  await screen.findByRole('heading', { name: 'Acceptance' });
  expect(screen.getByTestId('destination')).toHaveTextContent(privatePath);
});
test('an unpublished agreement never appears on the guest page', async () => {
  commands.getPublicServiceAgreement.mockResolvedValue({ data: { agreement: { ...agreement, status: 'draft' } } });
  mount();
  expect(await screen.findByRole('heading', { name: 'We could not verify this review link' })).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Acceptance' })).not.toBeInTheDocument();
  expect(screen.queryByText('Weekly Pool Service')).not.toBeInTheDocument();
});

test.each([['guest', privatePath, null, 'acceptPublicSalesServiceAgreement'], ['profile', profilePath, homeowner, 'acceptSalesServiceAgreement']])('the %s acceptance widget retains signature and confirmation behavior', async (_, path, user, callable) => {
  mount(path, user);
  const card = within(await screen.findByRole('region', { name: 'Acceptance' }));
  fireEvent.change(card.getByLabelText('Signature Name'), { target: { value: 'Home Owner Signature' } });
  card.getAllByRole('checkbox').forEach(checkbox => fireEvent.click(checkbox));
  fireEvent.change(card.getByLabelText('Note', { exact: true }), { target: { value: 'Keep the gate closed.' } });
  if (user) fireEvent.click(screen.getByRole('button', { name: /^Pay right away/ }));
  await act(async () => fireEvent.click(card.getByRole('button', { name: 'Accept Service Agreement' })));
  await waitFor(() => expect(commands[callable]).toHaveBeenCalledWith(expect.objectContaining({ agreementId: 'agreement', signatureName: 'Home Owner Signature', acceptedTerms: true, acceptedPricing: true, acceptedAutopayNotice: true, acceptanceNote: 'Keep the gate closed.' })));
  if (user) expect(commands[callable].mock.calls[0][0]).toEqual(expect.objectContaining({ customerBillingPreference: 'payNow', createBillingSubscriptionOnAcceptance: true }));
});
test.each([['guest', privatePath, null, 'rejectPublicSalesServiceAgreement'], ['profile', profilePath, homeowner, 'rejectSalesServiceAgreement']])('the %s widget sends a change request as a change request', async (_, path, user, callable) => {
  mount(path, user);
  const card = within(await screen.findByRole('region', { name: 'Acceptance' }));
  fireEvent.change(card.getByLabelText('Questions or requested changes'), { target: { value: 'Please quote service every other week.' } });
  await act(async () => fireEvent.click(card.getByRole('button', { name: 'Request Changes' })));
  await waitFor(() => expect(commands[callable]).toHaveBeenCalledWith(expect.objectContaining({ agreementId: 'agreement', responseType: 'changesRequested', rejectionNote: 'Please quote service every other week.' })));
});
test.each([['guest', privatePath, null, 'rejectPublicSalesServiceAgreement'], ['profile', profilePath, homeowner, 'rejectSalesServiceAgreement']])('the %s widget can still decline the agreement', async (_, path, user, callable) => {
  mount(path, user);
  const card = within(await screen.findByRole('region', { name: 'Acceptance' }));
  await act(async () => fireEvent.click(card.getByRole('button', { name: 'Decline Agreement' })));
  expect(commands[callable]).toHaveBeenCalledWith(expect.objectContaining({ agreementId: 'agreement', responseType: 'rejected' }));
});
